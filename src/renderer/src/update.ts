import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { api } from './api'

export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    api.update.state().then(setState)
    return api.update.onState(setState)
  }, [])
  return state
}
