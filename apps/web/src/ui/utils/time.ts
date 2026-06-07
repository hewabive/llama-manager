function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

export function formatLocalDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
  ].join(" ");
}

export function formatLocalHour(utcHour: string | null | undefined) {
  if (!utcHour) {
    return "-";
  }

  const date = new Date(`${utcHour}:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return utcHour.replace("T", " ");
  }

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)} ${pad(date.getHours())}:00`;
}
