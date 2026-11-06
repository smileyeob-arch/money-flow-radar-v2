# Money Flow Radar v2 — 집·직장 PC 수집 설치

## 새 운영 방식
- 키움 API 호출: IP가 등록된 집 데스크톱 또는 직장 노트북에서 실행.
- 신규 GitHub 저장소: 종목별 분석 결과 파일 data/latest.json만 저장.
- GitHub Actions: 저장소에 변경된 자료가 올라오면 웹 페이지를 자동 배포. 더 이상 GitHub 서버에서 키움 인증을 시도하지 않음.
- 기존 키움·인포스탁 프로그램은 수정하지 않음.

## 1. 각 PC에서 최초 설치
1. Python 3.11 이상, Git for Windows 설치. GitHub 로그인 가능해야 함.
2. PowerShell을 열어 다음 명령 실행:

    git clone https://github.com/smileyeob-arch/money-flow-radar-v2.git
    cd money-flow-radar-v2
    powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\setup-credentials.ps1

3. 키움 REST App Key와 Secret Key를 각각 입력. 입력 내용은 보이지 않고 해당 PC/Windows 사용자에 종속된 DPAPI 암호화 파일로 저장됨. 다른 PC에서도 동일 과정을 별도 수행.
4. 수동 수집 및 업로드 테스트:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\run-and-publish.ps1

5. 최초 Git push 시 GitHub 자격증명 관리자의 로그인 안내가 나타날 수 있음. 자신의 GitHub 계정으로 로그인. 저장소 push 권한 필요.

## 2. 평일 오후 5시 30분 자동 수집
오후 5시 30분에 켜져 있을 PC **한 대만** 선택해 다음 명령을 실행:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\install-daily-task.ps1

작업 스케줄러에 MoneyFlowRadar-Daily-1730 작업을 등록. 이 간단한 작업은 매일 실행되며 휴장일에는 별도의 시장 데이터 유효성 검사를 해야 한다. 휴장일에도 실행 자체는 시도될 수 있음. PC가 꺼져 있거나 절전·인터넷 연결 해제 상태면 실행되지 않음. 두 PC를 동시에 자동 실행 대상으로 설정하지 마세요.

## 3. 조회
- 웹앱 주소: https://smileyeob-arch.github.io/money-flow-radar-v2/
- Actions에서 초록 체크는 **웹 배포 성공**이며, 종목 데이터 수집 성공은 로컬 PC 로그에서 확인.
- 데이터 수집에 성공하지 못하면 결과 JSON은 수정하지 않음.

## 보안 및 문제 해결
- API 키를 채팅·GitHub 파일·스크린샷에 올리지 말 것.
- 로컬 인증키는 %LOCALAPPDATA%\MoneyFlowRadar 안에 보관되며 저장한 사용자와 PC에서만 복호화할 수 있음.
- 신규 GitHub 저장소의 옛 KIWOOM_APP_KEY / KIWOOM_SECRET_KEY Repository secrets는 로컬 수집 확인 후 삭제 권장.
- OAuth 인증 오류 8050이면 실행 PC의 공인 IP 등록을 확인. GitHub 서버 IP 오류와 분리.
- Python/Git 명령이 없다면 프로그램 설치 후 새 PowerShell 창을 열기.
- Git push 실패 시 GitHub 로그인/쓰기 권한/다른 PC의 변경사항과 충돌 여부 확인.
- 최초 API 호출의 데이터 필드/단위는 실제 키움 응답과 대조해 검증해야 함.
- 직장 노트북 자동 실행에는 직장 보안정책을 따르기.

## 종목 필터 (2026-11-06 변경)
- `ka10099`의 종목별 `marketCode`가 `0`(코스피), `10`(코스닥)인 일반 주식만 대상.
- ETF·ETN·리츠 등 별도 시장 분류 상품, 종목명 기준 스팩·리츠·우선주 제외.
- `ka10032` 순위 데이터 거래대금 **500억원 이상**만 남긴 다음 `ka10081` 실제 일봉 거래대금도 500억원 이상인지 재확인.
- 기존 거래대금 상위 100종목 제한을 해제하고 거래대금 500억원 이상 조건을 충족하는 종목을 조회 범위 내에서 모두 수집. 시장별 최대 10페이지 제한 도달 시 로그에 경고.
- 코드 배포만으로 기존 `data/latest.json`이 자동 재계산되지는 않음. **직장/집 PC에서 `run-and-publish.ps1`을 다시 실행**해야 웹에 새 필터가 반영됨.
- 종목명에 특이한 예외가 있으면 추후 검수 보완. 최초 실행은 API 응답 확인 필요.
