# 가짜 OpenAI 응답(글 초안 P3 시험용)

- 실제 OpenAI 응답이 아니다. Responses API 응답 모양(`output[].content[].output_text`·`refusal`, `incomplete_details`, `usage`)만 흉내 낸다.
- 모양 근거: OpenAI 공식 문서 Responses API(2026-11-20 확인). 첫 실제 호출(지시서 D-7)에서 다시 맞춘다.
- `response-completed.json`의 `__RESULT__`는 시험이 결과 JSON 문자열로 바꿔 넣는다.
- 키·실제 응답 ID·실제 글은 넣지 않는다.
