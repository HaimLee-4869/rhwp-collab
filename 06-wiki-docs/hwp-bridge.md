# HWP Bridge

## 개요

| 항목 | 상세 |
|------|------|
| **포트** | 9100 (CORE 서버) |
| **기능** | HWP ↔ 다른 형식 변환 |

## MCP 통합 (GenFilesMCP)

| 항목 | 상세 |
|------|------|
| **서버** | 220.124.155.35:5002/mcp |
| **버전** | GenFilesMCP v1.12.3 |
| **prefix** | `tool_v2` |

### 제공 도구

| 도구 | 기능 |
|------|------|
| `generate_hwp` | HWP 파일 생성 |
| `generate_word` | Word 파일 생성 |
| `generate_excel` | Excel 파일 생성 |
| `generate_powerpoint` | PPT 파일 생성 |
| `generate_markdown` | Markdown 생성 |
| `full_context_docx` | 전체 컨텍스트 Word |
| `review_docx` | 문서 리뷰 |

### HWP 생성 파라미터

- `content`: 본문 텍스트
- `file_name`: 파일명
- `user_id`: 사용자 ID
- `template_type`: default / v2

## 알려진 이슈

!!! warning "내용 축소 문제"
    task model이 긴 텍스트를 요약해서 전달하는 문제.
    `TOOLS_FUNCTION_CALLING_PROMPT_TEMPLATE`에 "전체 내용 복사, 요약 금지" 지시로 해결.

!!! bug "도구 설명 스왑"
    MCP 서버에서 generate_hwp 설명에 PPT 내용이 포함되는 버그 (서버 측).
