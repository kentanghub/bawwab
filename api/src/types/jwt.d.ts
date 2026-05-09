import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { role: string };
    user: { role: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: { role: string };
  }
}
