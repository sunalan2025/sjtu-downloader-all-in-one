import { useAppStore } from '../store/app'
import { CloudDrive } from '../features/cloud-drive/CloudDrive'

/** Account changes discard selections, cached paths and the internal clipboard. */
export function CloudPanExplorer() {
  const account = useAppStore(state => state.cloudUserToken)
  return <CloudDrive key={account || 'signed-out'} />
}
