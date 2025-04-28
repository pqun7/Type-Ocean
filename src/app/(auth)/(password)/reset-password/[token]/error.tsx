// app/reset-password/[token]/error.tsx
'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="text-center py-10">
      <h2 className="text-xl text-red-500 mb-4">
        {error.message || 'Something went wrong!'}
      </h2>
      <button
        onClick={() => reset()}
        className="bg-blue-500 text-white px-4 py-2 rounded"
      >
        Try Again
      </button>
    </div>
  )
}