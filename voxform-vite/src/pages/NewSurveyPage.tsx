import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Btn, Input, Textarea } from '@/components/ui'

export function NewSurveyPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/surveys', { title, description }),
    onSuccess: (s) => navigate(`/surveys/${s.id}`),
  })

  return (
    <div className="max-w-lg mx-auto px-8 py-16">
      <Link to="/surveys" className="text-[12px] font-mono text-dim hover:text-ink inline-flex items-center gap-1.5 mb-10">
        ← Surveys
      </Link>

      <h1 className="font-serif text-[32px] tracking-tight text-ink mb-1">New survey</h1>
      <p className="text-[13px] text-dim mb-10">You can edit everything later in the builder.</p>

      <div className="space-y-5">
        <Input
          label="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Household Income Survey Q3"
          autoFocus
        />
        <Textarea
          label="Description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What is this survey about?"
          rows={3}
        />
        <Btn
          className="w-full mt-2"
          size="lg"
          disabled={!title.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Creating…' : 'Create survey →'}
        </Btn>
      </div>
    </div>
  )
}
