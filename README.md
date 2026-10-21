# K-MESH · TRELLIS.2 Image → 3D

사진 한 장 → PBR 텍스처가 입혀진 GLB 3D 모델. Microsoft TRELLIS.2 (4B, MIT 라이선스) 기반.

```
[폰 브라우저 index.html] ──이미지──▶ [GPU 서버 server.py + TRELLIS.2] ──GLB──▶ [three.js 뷰어 + CMF 소재]
```

## 1. GPU 준비
TRELLIS.2는 **Linux + NVIDIA GPU 24GB 이상**이 필요합니다 (A100/H100 검증, RTX 4090·L40S·A6000급 가능).
내 PC에 없으면 클라우드 GPU를 시간 단위로 빌리는 게 현실적입니다 (RunPod, Vast.ai, Lambda 등 — RTX 4090 / L40S 인스턴스, PyTorch + CUDA 12.4 템플릿).

## 2. TRELLIS.2 설치 (GPU 머신에서)
```bash
git clone -b main https://github.com/microsoft/TRELLIS.2.git --recursive
cd TRELLIS.2
. ./setup.sh --new-env --basic --flash-attn --nvdiffrast --nvdiffrec --cumesh --o-voxel --flexgemm
conda activate trellis2
pip install fastapi "uvicorn[standard]" python-multipart
```
설치는 컴파일 때문에 20~40분 걸릴 수 있습니다. flash-attn을 지원하지 않는 GPU면 `export ATTN_BACKEND=xformers`.

## 3. 서버 실행
`server.py`와 `index.html`을 **TRELLIS.2 폴더 안에** 복사한 뒤:
```bash
python server.py        # http://0.0.0.0:8000 , 첫 실행 시 모델(약 16GB) 자동 다운로드
```

## 4. 폰에서 접속 (https 터널)
```bash
# 같은 GPU 머신에서
cloudflared tunnel --url http://localhost:8000
# → https://xxxx.trycloudflare.com 주소가 출력됨
```
- 그 주소를 폰으로 열면 바로 사용 가능 (서버가 index.html을 직접 서빙).
- 또는 index.html을 GitHub Pages(kyuil71.github.io)에 올리고, ① GPU 서버 칸에 터널 주소 입력.
- GitHub Pages(https)에서는 http 주소를 쓸 수 없으니 반드시 https 터널 주소를 쓰세요.

## 5. 사용
1. 연결 확인 → GPU 이름이 뜨면 준비 완료
2. 카메라/갤러리로 이미지 선택 (사물 1개, 정면 3/4 각도, 단순 배경이 가장 좋음)
3. 해상도: 512(빠름) / 1024(균형) / 1536(정밀)
4. 3D 생성 → 자동으로 뷰어 이동
5. 뷰어: 원본/클레이/와이어/노멀, CMF 소재 10종 교체, 거칠기·금속성·클리어코트 조절, GLB 저장, PNG 캡처

## 소요 시간 참고 (공식 H100 기준, 형상+재질만)
| 해상도 | 시간 |
|---|---|
| 512³ | 약 3초 |
| 1024³ | 약 17초 |
| 1536³ | 약 60초 |

RTX 4090급은 대략 2~3배, 여기에 GLB 추출(리메시·텍스처 베이크) 시간이 더해집니다.

## API (다른 도구에서 재사용할 때)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 모델 로드 상태·GPU 정보 |
| POST | `/jobs` | multipart: `image`, `resolution`, `seed`, `decimation`, `texture_size`, `steps`, `ss_guidance`, `shape_guidance`, `tex_guidance`, `remove_bg` → `{id, seed}` |
| GET | `/jobs/{id}` | `status`(queued/running/done/error), `stage`, `progress`, `preview` |
| GET | `/jobs/{id}/glb` | 결과 GLB |

환경변수: `PORT`, `TRELLIS_MODEL`, `KMESH_ORIGINS`(CORS 허용 주소, 기본 `*` — 공개 운영 시 `https://kyuil71.github.io`로 제한 권장).
