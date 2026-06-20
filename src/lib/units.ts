import { useSettingsStore } from '../store/settings'

export function useUnit() {
  const unit_system = useSettingsStore(s => s.settings?.unit_system ?? 'imperial')
  return {
    system: unit_system,
    label: unit_system === 'imperial' ? 'lbs' : 'kg',
  }
}
