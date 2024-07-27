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

