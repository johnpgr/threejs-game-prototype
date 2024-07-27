// vite.config.ts
//@ts-expect-error wtf
import UnpluginTypia from "@ryoppippi/unplugin-typia/vite";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [UnpluginTypia()],
    server: {
        port: 6969,
    }
});
