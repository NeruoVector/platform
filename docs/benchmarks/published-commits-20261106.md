# 변경사항 푸시 기록

2026-11-06. 기능 변경과 데모 편집본을 먼저 푸시했고, 사양 측정 도구·문서는 후속 커밋으로 추가한다.

| 저장소 | 브랜치 | 커밋 | 메시지 |
|---|---|---|---|
| platform | main | `07e89fd1` | feat: publish integrated school delivery deployment and CI |
| platform | main | `d89019d3` | fix: keep CI build definitions inside the Docker context |
| platform | main | `24b6cd64` | feat: publish integrated school delivery and admin deployment |
| platform | main | `7e4f519b` | feat: share product photo management with monitoring |
| platform | main | `1250bed6` | feat: import official snack catalog metadata and photos |
| platform | main | `a5dda648` | feat: publish recorded service demos with Korean subtitles |
| platform | main | `6e99dfdb` | fix: publish dashboard through the writable fork |
| frontend | work/damselfish | `612dc0b` | feat: polish supported ordering and drone delivery flows |
| backend | work/damselfish | `e8e6d4d` | feat: complete customer auth and delivery service APIs |
| sim | work/damselfish | `e4d20b6` | feat: synchronize school flight routes and depth safety |
| nv-dash | main | `d956365` | feat: connect admin dashboard to live school services |
| drone | work/damselfish | `b5588d4` | test: verify the packaged delivery safety API |
| vision | work/damselfish | `68dca3d` | feat: add bounded school inference and supplemental object detection |

관리자 저장소는 NeruoVector/nv-dash에 대한 쓰기 권한이 없어 Helloworld0822/nv-dash 공개 포크의 main에 푸시했다. 상위 .gitmodules도 이 포크를 가리킨다. 다른 하위 저장소의 work/damselfish 브랜치는 NeruoVector 원격에 푸시했다. vision의 기존 커밋은 이미 원격에 있었다.

.env, runtime, 데이터베이스 복구 백업, 임시 녹화·인코딩 파일과 ZIP은 커밋하지 않았다. 원본 파일은 로컬에 보존했다.
