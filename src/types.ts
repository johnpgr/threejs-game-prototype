import {tags} from "typia";

export type u32 = number & tags.Type<"uint32">;
export type i32 = number & tags.Type<"int32">;
export type i64 = number & tags.Type<"int64">;
export type u64 = number & tags.Type<"uint64">;
export type f32 = number & tags.Type<"float">;
export type f64 = number & tags.Type<"double">;
