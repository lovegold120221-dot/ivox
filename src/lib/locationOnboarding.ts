const LEGACY_JUST_REGISTERED_KEY = 'beatrice_just_registered';
const LEGACY_LOCATION_DONE_KEY = 'beatrice_location_done';

const locationPendingKey = (userId: string) => `beatrice_location_prompt_pending_${userId}`;
const locationDoneKey = (userId: string) => `beatrice_location_done_${userId}`;

export function markLocationOnboardingPending(userId: string) {
  try {
    localStorage.setItem(locationPendingKey(userId), 'true');
  } catch {}
}

export function markLocationRegistrationPending() {
  try {
    localStorage.setItem(LEGACY_JUST_REGISTERED_KEY, 'true');
  } catch {}
}

export function clearLocationRegistrationPending() {
  try {
    localStorage.removeItem(LEGACY_JUST_REGISTERED_KEY);
  } catch {}
}

export function shouldShowLocationOnboarding(userId: string): boolean {
  try {
    const pending =
      localStorage.getItem(locationPendingKey(userId)) === 'true' ||
      localStorage.getItem(LEGACY_JUST_REGISTERED_KEY) === 'true';
    const done = localStorage.getItem(locationDoneKey(userId)) === 'true';
    return pending && !done;
  } catch {
    return false;
  }
}

export function markLocationOnboardingComplete(userId: string) {
  try {
    localStorage.setItem(locationDoneKey(userId), 'true');
    localStorage.setItem(LEGACY_LOCATION_DONE_KEY, 'true');
    localStorage.removeItem(locationPendingKey(userId));
    localStorage.removeItem(LEGACY_JUST_REGISTERED_KEY);
  } catch {}
}
