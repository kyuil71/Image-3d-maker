# GPT-face · Tasha 음성 대화

이 폴더를 `kyuil71/Image-3d-maker` 저장소의 `GPT-face` 경로에 넣으면 기존 GitHub Pages 배포 설정 아래에서 사용할 수 있습니다.

예상 실행 주소: https://kyuil71.github.io/Image-3d-maker/GPT-face/

## 사용법
1. 페이지를 열고 `연결 설정`을 누릅니다.
2. 본인의 OpenAI API 키를 입력하고 `설정 적용`을 누릅니다.
3. `마이크로 대화 시작`을 누르고 마이크 사용을 허용합니다.
4. “고개를 숙여 주세요”, “왼쪽을 봐 주세요”, “오른팔을 올려 주세요”, “웃으면서 손을 흔들어 주세요”처럼 요청해 보세요.

원본에 없던 표정 키·관절을 추가한 프로토타입입니다. 사람과 동일한 얼굴 근육 표현이나 전문적인 발음별 립싱크는 아닙니다. 입은 출력 음성의 크기·주파수에 반응합니다. 일부 의상·관절 변형이 자연스럽지 않을 수 있습니다.

실제 유료 API 키가 없어 음성 대화·말 끊기·동작 인식의 실통화 검증은 하지 못했습니다. 이벤트 처리의 코드 검사와 Blender 모델 렌더링은 수행했습니다. 검증용 브라우저의 WebGL 가속이 비활성화되어 실시간 3D 재생은 확인하지 못했습니다. Chrome/Edge에서 하드웨어 가속을 활성화해 주세요.

왼쪽·오른쪽은 캐릭터 본인 기준입니다. 동작은 보통 4초 뒤 원래 자세로 돌아오며, 음성으로 최대 12초까지 요청할 수 있습니다. 헤드폰을 사용하면 출력 음성이 마이크에 들어가는 오작동을 줄일 수 있습니다.

## API 키
별도 서버 없이 GitHub Pages에서 실행하는 개인용 BYOK 버전입니다. 키는 입력한 탭의 메모리에만 보관하고 OpenAI의 세션 발급 API에 직접 전송합니다. 파일·로컬 저장소·GitHub에 저장하지 않습니다. 이후 단기 키로 OpenAI Realtime API와 연결합니다. 브라우저 내에서 키를 사용하는 방식이므로 본인 키로 사용하는 개인용 실행판으로 취급해 주세요. 다수 사용자를 대상으로 운영할 때에는 서버에서 단기 키를 발급하는 방식으로 바꾸는 것이 적합합니다.

ChatGPT 구독과 별도로 OpenAI API 요금이 발생합니다. 음성은 OpenAI로 전송됩니다. 사용자 카메라는 사용하지 않으며 사용자의 얼굴을 분석하지 않습니다.

## 파일
- index.html / style.css / app.js: 화면 및 대화·동작 제어
- tasha.glb: 원본에서 변환하고 표정·관절을 추가한 모델
- vendor/: Three.js r170 및 GLTFLoader, OrbitControls, BufferGeometryUtils
- portrait.jpg: WebGL 미지원 환경의 정적 안내 이미지

Three.js는 MIT License입니다: https://github.com/mrdoob/three.js/blob/r170/LICENSE
캐릭터의 이용 권리는 업로드한 원본 모델의 라이선스를 따릅니다.

OpenAI 공식 문서:
https://developers.openai.com/api/docs/guides/voice-webrtc
https://developers.openai.com/api/docs/guides/realtime-conversations
