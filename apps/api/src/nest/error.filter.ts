import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { toHttpError } from '../http/http-error';

/** DomainError/ZodError/DbError → JSON {code, message, details}. HttpException bawaan Nest (404 route, 413) diteruskan. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return res.status(status).json({ code: status === 404 ? 'ROUTE_NOT_FOUND' : 'HTTP_ERROR', message: status === 404 ? 'Endpoint tidak ditemukan.' : exception.message });
    }
    const mapped = toHttpError(exception);
    if (mapped.unexpected) this.logger.error(`${req.method} ${req.url}`, (exception as Error)?.stack);
    return res.status(mapped.status).json(mapped.body);
  }
}
