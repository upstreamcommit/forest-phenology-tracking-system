import { SegmentedControl, type SegmentedOption } from '../../components/SegmentedControl'
import { METRIC_KEYS, METRICS, type MetricKey } from './metrics'

const OPTIONS: SegmentedOption<MetricKey>[] = METRIC_KEYS.map((key) => ({
  value: key,
  label: METRICS[key].label,
  description: METRICS[key].description,
}))

/** Which metric colours the map. */
export function MetricPicker({
  value,
  onChange,
}: {
  value: MetricKey
  onChange: (metric: MetricKey) => void
}) {
  return (
    <SegmentedControl label="Colour cells by" options={OPTIONS} value={value} onChange={onChange} />
  )
}
