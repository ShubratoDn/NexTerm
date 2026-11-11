import type { TermApi } from '../shared/api';

declare global {
  interface Window {
    termApi: TermApi;
  }
}

export {};
