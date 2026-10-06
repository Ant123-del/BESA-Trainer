//one color per activity, shared by the clock-out split bar and the Manage Admins analytics chart so an
//activity always looks the same. Slots are the reference data-viz palette's dark steps, in its fixed order
//(validated on this app's gray-800 chart surface: CVD-safe for adjacent pairs; slot 6 green sits just under
//3:1 contrast, so every use also carries a text label and the analytics has a table view).
export const ACTIVITY_PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]
//past 8 activities there's no 9th hue - extras share a neutral gray (the chart folds them into "Other")
export const OTHER_COLOR = "#6b7280"

//color follows the activity's place in the shared activity-type order, never its rank in a chart or which
//ones happen to be selected - so picking/unpicking or filtering never repaints the others
export function activityColor(activity: string, order: string[]): string {
    const index = order.indexOf(activity)
    return index >= 0 && index < ACTIVITY_PALETTE.length ? ACTIVITY_PALETTE[index] : OTHER_COLOR
}

//white or near-black text, whichever clears contrast on a given fill (for labels inside colored segments)
export function textOn(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    const channel = (v: number) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
    return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#111827" : "#ffffff"
}

//starting split for the clock-out bar - every picked activity gets an equal share
export function evenFractions(count: number): number[] {
    return Array.from({length: count}, () => 1 / count)
}
