declare module 'japanese-holidays' {
  /** Holiday name for a local date, or undefined. Substitute holidays (振替休日) included by default. */
  export function isHoliday(date: Date, furikae?: boolean): string | undefined
  const JapaneseHolidays: { isHoliday: typeof isHoliday }
  export default JapaneseHolidays
}
