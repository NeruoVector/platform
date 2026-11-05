// 빈 값이면 현재 오리진의 /api 를 사용한다. 개발 서버는 Vite proxy 로 백엔드에 연결된다.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

type ApiErrorBody = {
  error?: string
  message?: string
}

export async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as ApiErrorBody
    if (body.message) return body.message
    if (body.error) return body.error
  } catch {
    // JSON 이 아닌 응답은 상태 코드로만 안내한다.
  }
  return `API ${response.status}`
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
}
