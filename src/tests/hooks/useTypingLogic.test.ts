// hooks/useTypingLogic.test.ts
import { renderHook, act } from '@testing-library/react-hooks'
import  useTypingLogic  from '@/components/hooks/useTypingLogic'

const mockText = 'The quick brown fox'
const mockSelectNewText = jest.fn()

describe('useTypingLogic', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should start game on first input', () => {
    const { result } = renderHook(() =>
      useTypingLogic(mockText, mockSelectNewText)
    )

    act(() => {
      result.current.handleInputChange({ target: { value: 'T' } } as any)
    })

    expect(result.current.state).toBe('running')
  })

  it('should detect idle state', () => {
    const { result } = renderHook(() =>
      useTypingLogic(mockText, mockSelectNewText)
    )

    act(() => {
      result.current.handleInputChange({ target: { value: 'T' } } as any)
      jest.advanceTimersByTime(5000)
    })

    expect(result.current.isIdle).toBe(true)
  })
})