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

---

## K-ANCHOR · AI 아나운서 (`/announcer/`)

글을 붙여 넣으면 3D 아나운서(기본 HANA, 또는 FREYA 선택)가 소리 내어 읽으며 입모양·표정·눈깜박임·고개 움직임을 만듭니다. WebGL(three.js) 단일 HTML + `freya.glb`.

- 주소: https://kyuil71.github.io/Image-3d-maker/announcer/
- **기기 음성**: 폰 내장 한국어 TTS(삼성·구글). 무료. 한글을 초성·중성·종성으로 분해해 입모양(아·에·이·오·우·으·어, ㅁㅂㅍ 입술 닫힘 등) 타임라인을 만들고, 단어 경계 이벤트와 문장 길이 학습으로 속도를 맞춥니다.
- **Gemini 음성**: Gemini TTS(`gemini-3.8-flash-tts`, Interactions API)로 사람 같은 음성을 생성하고, 실제 파형의 크기와 무음 구간을 분석해 턱 움직임과 문장 타이밍을 맞춥니다. API 키는 브라우저 localStorage에만 저장됩니다.
- 표정: 문장 내용(감사·축하 / 사고·우려)과 문장부호(? !)로 자동 전환, 또는 밝게·차분·진지 고정.
- 녹화: 화면을 mp4/webm으로 저장(Gemini 음성은 소리 포함).

모델: 원본 `Freya.blend`의 Rigify 얼굴 컨트롤로 만든 15개 표정(턱 벌림·입 넓힘·오므림·입술 닫힘·미소 좌우·눈 감기 좌우·눈썹 등)을 셰이프키로 구워 GLB 모프 타깃으로 내보냈습니다(meshopt 압축, 약 4.9MB).

### 아나운서 2명
- **HANA (기본)**: `hana.glb` — Auto-Rig Pro 리그 원본. IK로 팔을 내린 자세를 기본형으로 굽고, 얼굴 컨트롤(턱·입술·눈꺼풀·눈썹·볼)로 같은 15개 표정을 셰이프키로 구웠습니다(눈 감김 양은 자동 보정). `tools/bake_girl.py`, `tools/shapes_girl.json`.
- **FREYA**: `freya.glb` — Rigify 리그 원본. `tools/bake_export.py`, `tools/shapes.json`.
- 두 인물 모두 같은 모프 이름을 쓰므로 입모양·표정 엔진은 공용이며, 인물별 차이(머리·목·눈·혀 본 이름, 카메라 높이)는 `index.html`의 `AVATARS` 설정에 있습니다.

### 자세 20종 (`자세 정하기`)
기본·고개 숙이기/들기/갸웃·인사·오른손/왼손 들기·만세·손 흔들기·허리에 손·팔짱·손 모으기·생각하기·의자에 앉기·쪼그려 앉기·무릎 꿇기·한쪽 다리 들기·눕기·엎드리기·옆으로 눕기.
관절 회전(`POSES`)을 인물별 본 이름(`AVATARS.*.joints`)에 매핑하고, 발·무릎·손·엉덩이·가슴·머리 접점으로 바닥 높이를 자동으로 맞춥니다. HANA는 굽기 단계에서 Auto-Rig Pro 변형 본을 정상 FK 계층으로 재구성하고, 팔 내린 자세를 기본 자세로 적용했습니다(가슴 볼륨도 이 단계에서 조정).
