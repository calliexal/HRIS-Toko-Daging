/** Token DI NestJS. Semua service dirakit oleh buildServices() (src/app/container.ts). */
export const CONFIG = Symbol('CONFIG');
export const DATABASE = Symbol('DATABASE');
export const SERVICES = Symbol('SERVICES');
export const HANDLERS = Symbol('HANDLERS');
export const ROUTE_NAME = 'dp:route';
