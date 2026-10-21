"""
K-MESH · TRELLIS.2 Image-to-3D 서버
-----------------------------------
microsoft/TRELLIS.2 (MIT) 를 감싸는 FastAPI 서버.
index.html(모바일 프런트)에서 이미지를 받아 GLB를 돌려준다.

실행 (TRELLIS.2 저장소 루트에서, conda env 'trellis2' 활성화 상태):
    pip install fastapi "uvicorn[standard]" python-multipart
    python server.py                # 0.0.0.0:8000

요구사항: Linux + NVIDIA GPU 24GB 이상 (A100/H100/RTX 4090/L40S 등)
"""
import os
os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import io
import time
import uuid
import base64
import queue
import threading
import traceback
from datetime import datetime

from PIL import Image
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "kmesh_out")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL_ID = os.environ.get("TRELLIS_MODEL", "microsoft/TRELLIS.2-4B")
PIPELINE_TYPES = {"512": "512", "1024": "1024_cascade", "1536": "1536_cascade"}
MAX_SEED = 2**31 - 1
JOB_TTL_SEC = 60 * 60 * 6  # 6시간 뒤 결과 정리

# ------------------------------------------------------------------
# 파이프라인 (첫 요청 전에 로드)
# ------------------------------------------------------------------
pipeline = None
pipeline_error = None


def load_pipeline():
    global pipeline, pipeline_error
    try:
        from trellis2.pipelines import Trellis2ImageTo3DPipeline
        p = Trellis2ImageTo3DPipeline.from_pretrained(MODEL_ID)
        p.cuda()
        pipeline = p
        print(f"[K-MESH] pipeline ready: {MODEL_ID}")
    except Exception as e:  # noqa: BLE001
        pipeline_error = f"{type(e).__name__}: {e}"
        traceback.print_exc()


# ------------------------------------------------------------------
# 작업 큐 (GPU 1장 = 작업 1개씩 순차 처리)
# ------------------------------------------------------------------
jobs: dict = {}
jobs_lock = threading.Lock()
job_queue: "queue.Queue[str]" = queue.Queue()


def set_job(job_id, **kw):
    with jobs_lock:
        jobs[job_id].update(kw)


def png_data_url(img: Image.Image, max_side=512) -> str:
    im = img.copy()
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def export_glb(mesh, res, decimation_target, texture_size, out_path):
    import o_voxel
    common = dict(
        vertices=mesh.vertices,
        faces=mesh.faces,
        attr_volume=mesh.attrs,
        coords=mesh.coords,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=decimation_target,
        texture_size=texture_size,
        remesh=True,
        remesh_band=1,
        remesh_project=0,
    )
    try:
        # app.py (최신) 시그니처
        glb = o_voxel.postprocess.to_glb(
            attr_layout=pipeline.pbr_attr_layout, grid_size=res, **common
        )
    except TypeError:
        # README 예제 시그니처 (구버전 호환)
        glb = o_voxel.postprocess.to_glb(
            attr_layout=mesh.layout, voxel_size=mesh.voxel_size, **common
        )
    glb.export(out_path, extension_webp=True)


def run_job(job_id):
    import torch
    with jobs_lock:
        job = dict(jobs[job_id])
    p = job["params"]
    t0 = time.time()
    try:
        image = Image.open(io.BytesIO(job["image_bytes"]))
        image.load()

        # 1) 배경 제거·크롭 (TRELLIS.2 내장 전처리)
        set_job(job_id, status="running", stage="배경 제거", progress=0.08)
        if p["remove_bg"]:
            image = pipeline.preprocess_image(image)
        set_job(job_id, preview=png_data_url(image))

        # 2) 3단계 생성 (구조 → 형상 → 재질)
        set_job(job_id, stage="형상·재질 생성", progress=0.2)
        steps = p["steps"]
        outputs, latents = pipeline.run(
            image,
            seed=p["seed"],
            preprocess_image=False,
            sparse_structure_sampler_params={
                "steps": steps, "guidance_strength": p["ss_guidance"],
                "guidance_rescale": 0.7, "rescale_t": 5.0,
            },
            shape_slat_sampler_params={
                "steps": steps, "guidance_strength": p["shape_guidance"],
                "guidance_rescale": 0.5, "rescale_t": 3.0,
            },
            tex_slat_sampler_params={
                "steps": steps, "guidance_strength": p["tex_guidance"],
                "guidance_rescale": 0.0, "rescale_t": 3.0,
            },
            pipeline_type=PIPELINE_TYPES[p["resolution"]],
            return_latent=True,
        )
        mesh = outputs[0]
        res = latents[2]
        mesh.simplify(16777216)  # nvdiffrast 한계

        # 3) GLB 추출 (리메시 + 감면 + UV + PBR 텍스처 베이크)
        set_job(job_id, stage="GLB 추출 (리메시·텍스처 베이크)", progress=0.7)
        out_path = os.path.join(OUT_DIR, f"{job_id}.glb")
        export_glb(mesh, res, p["decimation"], p["texture_size"], out_path)

        del outputs, latents, mesh
        torch.cuda.empty_cache()
        set_job(
            job_id, status="done", stage="완료", progress=1.0,
            glb_path=out_path, elapsed=round(time.time() - t0, 1),
            size_mb=round(os.path.getsize(out_path) / 1e6, 2),
        )
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        try:
            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass
        set_job(job_id, status="error", stage="오류", error=f"{type(e).__name__}: {e}")
    finally:
        set_job(job_id, image_bytes=None)


def worker():
    while True:
        job_id = job_queue.get()
        try:
            run_job(job_id)
        finally:
            job_queue.task_done()


def cleanup_loop():
    while True:
        time.sleep(600)
        now = time.time()
        with jobs_lock:
            old = [k for k, v in jobs.items() if now - v["created"] > JOB_TTL_SEC]
            for k in old:
                path = jobs[k].get("glb_path")
                if path and os.path.exists(path):
                    os.remove(path)
                del jobs[k]


# ------------------------------------------------------------------
# API
# ------------------------------------------------------------------
app = FastAPI(title="K-MESH TRELLIS.2 server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("KMESH_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    threading.Thread(target=load_pipeline, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=cleanup_loop, daemon=True).start()


@app.get("/health")
def health():
    gpu = None
    try:
        import torch
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            gpu = {"name": props.name, "vram_gb": round(props.total_memory / 1024**3, 1)}
    except Exception:  # noqa: BLE001
        pass
    return {
        "ok": pipeline is not None,
        "loading": pipeline is None and pipeline_error is None,
        "error": pipeline_error,
        "model": MODEL_ID,
        "gpu": gpu,
        "queue": job_queue.qsize(),
    }


@app.post("/jobs")
async def create_job(
    image: UploadFile = File(...),
    resolution: str = Form("1024"),
    seed: int = Form(-1),
    decimation: int = Form(300000),
    texture_size: int = Form(2048),
    steps: int = Form(12),
    ss_guidance: float = Form(7.5),
    shape_guidance: float = Form(7.5),
    tex_guidance: float = Form(1.0),
    remove_bg: bool = Form(True),
):
    if pipeline is None:
        raise HTTPException(503, pipeline_error or "모델 로딩 중입니다. 잠시 후 다시 시도하세요.")
    if resolution not in PIPELINE_TYPES:
        raise HTTPException(400, "resolution은 512 / 1024 / 1536 중 하나")
    data = await image.read()
    if not data:
        raise HTTPException(400, "빈 이미지")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "이미지는 20MB 이하")
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "이미지 파일을 읽을 수 없습니다")

    if seed < 0:
        seed = int.from_bytes(os.urandom(4), "little") % MAX_SEED
    params = dict(
        resolution=resolution, seed=seed,
        decimation=max(10000, min(1_000_000, decimation)),
        texture_size=texture_size if texture_size in (1024, 2048, 4096) else 2048,
        steps=max(4, min(50, steps)),
        ss_guidance=ss_guidance, shape_guidance=shape_guidance, tex_guidance=tex_guidance,
        remove_bg=remove_bg,
    )
    job_id = datetime.now().strftime("%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    with jobs_lock:
        jobs[job_id] = dict(
            id=job_id, status="queued", stage="대기열", progress=0.0,
            params=params, image_bytes=data, created=time.time(),
        )
    job_queue.put(job_id)
    return {"id": job_id, "seed": seed, "queue": job_queue.qsize()}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "작업을 찾을 수 없습니다")
        out = {k: v for k, v in job.items() if k not in ("image_bytes", "glb_path")}
    return JSONResponse(out)


@app.get("/jobs/{job_id}/glb")
def get_glb(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        raise HTTPException(404, "GLB가 아직 없습니다")
    return FileResponse(job["glb_path"], media_type="model/gltf-binary",
                        filename=f"kmesh_{job_id}.glb")


@app.get("/", response_class=HTMLResponse)
def index():
    """같은 폴더의 index.html을 그대로 서빙 (터널 주소 하나로 바로 사용)."""
    path = os.path.join(HERE, "index.html")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    return "<h1>K-MESH server</h1><p>index.html을 같은 폴더에 두세요.</p>"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
