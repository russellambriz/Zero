export const APP_VERSION='1.1.0';
export const APP_BUILD='__BUILD__';
export const CACHE_NAME='zero-shell-dev';
export function buildLabel(build=APP_BUILD){return !build||String(build).startsWith('__')?'dev':build;}
