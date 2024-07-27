// preload.ts
import { plugin } from 'bun';
//@ts-expect-error wtf
import UnpluginTypia from '@ryoppippi/unplugin-typia/bun'

plugin(UnpluginTypia())
