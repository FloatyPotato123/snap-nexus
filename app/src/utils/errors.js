/**
 * Error Handling Utilities
 * 
 * Provides custom error classes and error response helpers
 * for consistent error handling throughout the application.
 */

/**
 * Base application error class
 */
export class AppError extends Error {
    /**
     * @param {string} message - Error message
     * @param {number} statusCode - HTTP status code
     * @param {string} [code] - Error code for client handling
     */
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Logs an error with context
 * @param {string} context - Where the error occurred (e.g., "[Scraper]", "[Players API]")
 * @param {Error} error - The error to log
 * @param {Object} [metadata] - Additional context to log
 */
export function logError(context, error, metadata = {}) {
    const logMessage = `${context} Error: ${error.message}`;

    if (Object.keys(metadata).length > 0) {
        console.error(logMessage, metadata, error);
    } else {
        console.error(logMessage, error);
    }
}
