import app from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import logger from './config/logger';
import { env } from './config/env';
import { minioService } from './services/MinioService';

const PORT = env.PORT;

// Connect to database
connectDatabase()
  .then(() => {
    // Initialize MinIO service for KYC vault presigned URLs
    minioService.initialize();

    // Start server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Main Admin Service running on port ${PORT}`);
      logger.info(`   Environment: ${env.NODE_ENV}`);
    });
    
    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
