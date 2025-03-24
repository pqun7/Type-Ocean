// components/Caret.test.tsx
import { render } from '@testing-library/react'
import Caret from '@/components/TypingTest/Caret'

describe('Caret', () => {
  it('should render at correct position', () => {
    const { container } = render(
      <Caret caretPosition={{ x: 100, y: 50 }} caretHeight="h-6" />
    )
    
    const caret = container.firstChild as HTMLElement
    expect(caret).toHaveStyle('left: 100px')
    expect(caret).toHaveStyle('top: 50px')
  })
})