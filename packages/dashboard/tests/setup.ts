// Vitest global setup — auto-cleanup rendered React trees between tests so
// multiple render() calls in the same file don't accumulate DOM elements.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
