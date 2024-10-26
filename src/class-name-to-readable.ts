export default function classNameToReadable(name: string): string {
  const readableName = name.replace(/([A-Z])/g, " $1").trim()
  return readableName.charAt(0).toUpperCase() + readableName.slice(1).toLowerCase()
}
