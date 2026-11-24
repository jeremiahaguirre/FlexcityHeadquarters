import { defineConfig } from 'vitest/config';

// Component tests render TSX on the server (react-dom/server): React 19's automatic JSX runtime,
// as Next uses, instead of tsconfig's "preserve" (left for Next to compile). Playwright files in e2e/ are not Vitest's.
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { exclude: ['**/node_modules/**', 'e2e/**', 'out/**', '.next/**'] } });
