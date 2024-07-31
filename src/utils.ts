export function assert(condition: boolean, msg?: string): asserts condition {
    if (!condition) {
        throw new Error(msg);
    }
}

export function unreachable(msg: string): never {
    throw new Error(msg);
}

export function exhaustive(x: never): never {
    throw new Error(`Unexpected value: ${x}`);
}

export function objectToFriendlyString(obj: Record<string, any>): string {
  const result: string[] = [];

  function parseObject(obj: Record<string, any>, prefix: string = '') {
    for (const [key, value] of Object.entries(obj)) {
      const formattedKey = prefix + key.charAt(0).toUpperCase() + key.slice(1);

      if (typeof value === 'object' && value !== null) {
        const nestedValues = Object.entries(value)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        result.push(`${formattedKey}: ${nestedValues}`);
      } else {
        result.push(`${formattedKey}: ${value}`);
      }
    }
  }

  parseObject(obj);
  return result.join('\n');
}
