/**
 * HTTP Response Utilities
 * 
 * Provides standardized response helpers for consistent API responses.
 */

/**
 * Creates a standardized error JSON response
 * @param {Object} c - Hono context
 * @param {string} message - Error message
 * @param {number} [status=500] - HTTP status code
 * @param {string} [code] - Error code
 * @returns {Response} Hono response object
 */
export function errorResponse(c, message, status = 500, code = null) {
    const response = { error: message };
    if (code) {
        response.code = code;
    }
    return c.json(response, status);
}

/**
 * Creates a not found response
 * @param {Object} c - Hono context
 * @param {string} [message='Not found'] - Error message
 * @returns {Response} Hono response object
 */
export function notFoundResponse(c, message = 'Not found') {
    return errorResponse(c, message, 404, 'NOT_FOUND');
}

/**
 * Creates a bad request response
 * @param {Object} c - Hono context
 * @param {string} message - Error message
 * @returns {Response} Hono response object
 */
export function badRequestResponse(c, message) {
    return errorResponse(c, message, 400, 'BAD_REQUEST');
}
