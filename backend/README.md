# BFF Atomik

A Backend for Frontend (BFF) API built with TypeScript, tRPC, and MySQL, designed for deployment on DigitalOcean.

## 🚀 Features

- **TypeScript** - Full type safety and modern JavaScript features
- **tRPC** - End-to-end typesafe APIs with automatic client generation
- **Drizzle ORM** - Type-safe database access with MySQL
- **Express** - Fast, unopinionated web framework
- **Docker** - Containerized deployment ready
- **DigitalOcean** - Optimized for DigitalOcean App Platform

## 📋 Prerequisites

- Node.js 18+
- MySQL database (local or managed)
- Docker & Docker Compose (recommended for local development)

## 🛠️ Development Setup

### Option 1: Using Docker Compose (Recommended)

1. **Start the MySQL database:**

   ```bash
   # From the project root
   docker-compose up -d
   ```

   This will start a MySQL 8.0 database with the following credentials:

   - **Host:** localhost
   - **Port:** 3306
   - **Database:** atomik_clips_dev
   - **User:** atomik_user
   - **Password:** atomik_password
   - **Root Password:** rootpassword

2. **Set up environment variables:**
   Create a `.env` file in the `backend/` directory:

   ```env
   DATABASE_URL=mysql://atomik_user:atomik_password@localhost:3306/atomik_clips_dev
   NODE_ENV=development
   ```

3. **Install dependencies and set up the database:**

   ```bash
   cd backend
   npm install

   # Push schema to database
   npm run db:push

   # (Optional) Seed the database with sample data
   npm run db:seed
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3000`

### Option 2: Using an Existing MySQL Database

1. **Set up environment variables:**
   Create a `.env` file in the `backend/` directory:

   ```env
   DATABASE_URL=mysql://username:password@host:port/database_name
   NODE_ENV=development
   ```

2. **Install dependencies and set up the database:**

   ```bash
   cd backend
   npm install

   # Generate Drizzle migrations
   npm run db:generate

   # Push schema to database (for development)
   npm run db:push

   # Or run migrations (for production)
   npm run db:migrate
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## 🐳 Docker Commands

```bash
# Start MySQL database
docker-compose up -d

# View logs
docker-compose logs -f mysql

# Stop services (keeps data)
docker-compose stop

# Stop and remove containers (keeps data in volumes)
docker-compose down

# Stop and remove everything including data
docker-compose down -v

# Check database health
docker-compose ps
```

## 📚 API Documentation

### Health Check

- **GET** `/health` - Server health status

### tRPC Endpoints

- **Base URL:** `/trpc`

#### Users

- `users.getAll` - Get all users
- `users.getById` - Get user by ID
- `users.create` - Create new user
- `users.update` - Update user (protected)
- `users.delete` - Delete user (protected)

#### Posts

- `posts.getAll` - Get all posts
- `posts.getByAuthor` - Get posts by author
- `posts.getById` - Get post by ID
- `posts.create` - Create new post (protected)
- `posts.update` - Update post (protected)
- `posts.delete` - Delete post (protected)

### Example tRPC Client Usage

```typescript
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./src/routers";

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:3000/trpc",
    }),
  ],
});

// Usage
const users = await client.users.getAll.query();
const newUser = await client.users.create.mutate({
  email: "user@example.com",
  name: "John Doe",
});
```

## 🚀 Deployment

### DigitalOcean App Platform

1. **Connect your repository** to DigitalOcean App Platform
2. **Update `.do/app.yaml`** with your repository details
3. **Set environment variables** in the DigitalOcean dashboard:

   - `DATABASE_URL` - Your managed MySQL database connection string
   - `CORS_ORIGIN` - Your frontend domain
   - `NODE_ENV` - Set to `production`

4. **Deploy:**
   ```bash
   # Using doctl CLI
   doctl apps create --spec .do/app.yaml
   ```

### Manual Deployment

1. **Build the application:**

   ```bash
   npm run build
   ```

2. **Start production server:**
   ```bash
   npm start
   ```

## 🗄️ Database Schema

The default schema includes:

- **Users** - User management
- **Posts** - Blog posts with author relationships

Modify `prisma/schema.prisma` to match your existing database structure.

## 🔧 Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Drizzle Studio
- `npm run db:seed` - Seed database with sample data
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run typecheck` - Type check without building

## 🏗️ Project Structure

```
src/
├── lib/
│   ├── db.ts          # Database connection
│   └── trpc.ts        # tRPC configuration
├── routers/
│   ├── users.ts       # User routes
│   ├── posts.ts       # Post routes
│   └── index.ts       # Main router
└── index.ts           # Server entry point
```

## 🔒 Security Notes

- Update CORS origins for production
- Implement proper authentication middleware
- Use environment variables for sensitive data
- Consider rate limiting for production use

## 📝 License

MIT
