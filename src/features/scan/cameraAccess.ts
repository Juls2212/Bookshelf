// What the camera screen can show, from the permission response and camera errors.
import { PermissionStatus, type PermissionResponse } from 'expo-camera';

/**
 * `checking`: permission not read yet. `request`: never asked (we explain first, then ask).
 * `denied`: refused; only the system settings can change it. `unavailable`: no usable camera.
 */
type CameraAccess = 'checking' | 'request' | 'denied' | 'unavailable' | 'ready';

export function cameraAccessFor(
  permission: Pick<PermissionResponse, 'granted' | 'status' | 'canAskAgain'> | null,
  cameraFailed: boolean,
): CameraAccess {
  if (cameraFailed) return 'unavailable';
  if (!permission) return 'checking';
  if (permission.granted) return 'ready';
  return permission.status === PermissionStatus.UNDETERMINED && permission.canAskAgain
    ? 'request'
    : 'denied';
}
