import LoadingStatus from './LoadingStatus'

export default function RouteLoading({ fullScreen = false, label = 'Loading page…' }: { fullScreen?: boolean; label?: string }) {
  return <LoadingStatus compact fullScreen={fullScreen} label={label} />
}
