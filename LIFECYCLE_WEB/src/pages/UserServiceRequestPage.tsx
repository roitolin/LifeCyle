import { useParams } from 'react-router-dom'
import MyServiceRequestsPage from './MyServiceRequestsPage'

export default function UserServiceRequestPage() {
  const { requestId } = useParams<{ requestId: string }>()

  return <MyServiceRequestsPage detailRequestId={requestId || ''} />
}
