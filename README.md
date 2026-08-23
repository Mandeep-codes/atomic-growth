# Atomik Clips Monorepo

A monorepo containing the frontend and backend services for the Atomik Clips application.

## Project Structure

```
├── frontend/          # React/Vite frontend application
├── backend/           # tRPC backend with MySQL
├── docker-compose.yml # MySQL database for local development
├── package.json       # Root package.json with workspace configuration
└── pnpm-workspace.yaml # PNPM workspace configuration
```

## Technologies Used

### Frontend

- **Vite** - Build tool and dev server
- **React** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **tRPC** - Type-safe API client
- **React Router** - Routing

### Backend

- **TypeScript** - Full type safety
- **tRPC** - End-to-end typesafe APIs
- **Drizzle ORM** - Type-safe database access
- **MySQL** - Database
- **Express** - Web framework
- **Clerk** - Authentication

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- PNPM >= 8.0.0
- Docker & Docker Compose (for local database)

### Quick Start

1. **Start the local MySQL database:**

   ```bash
   docker-compose up -d
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Set up backend environment:**
   Create a `.env` file in the `backend/` directory:

   ```env
   DATABASE_URL=mysql://atomik_user:atomik_password@localhost:3306/atomik_clips_dev
   NODE_ENV=development
   ```

4. **Push database schema:**

   ```bash
   cd backend
   pnpm db:push
   ```

5. **(Optional) Seed the database with sample data:**

   ```bash
   pnpm db:seed
   cd ..
   ```

6. **Start development servers:**

   ```bash
   # Start both frontend and backend
   pnpm dev
   ```

### Development

```bash
# Start both frontend and backend
pnpm dev

# Start frontend only
pnpm dev:frontend

# Start backend only
pnpm dev:backend
```

### Building

```bash
# Build frontend
pnpm build:frontend
# or simply
pnpm build

# Build backend (when implemented)
pnpm build:backend
```

### Linting

```bash
# Lint frontend
pnpm lint:frontend
# or simply
pnpm lint

# Lint backend (when implemented)
pnpm lint:backend
```

## Docker Commands

Manage the local MySQL database:

```bash
# Start database
docker-compose up -d

# View logs
docker-compose logs -f mysql

# Stop database (keeps data)
docker-compose stop

# Stop and remove containers (keeps data in volumes)
docker-compose down

# Stop and remove everything including data
docker-compose down -v
```

## Workspace Commands

The root package.json includes convenient scripts to run commands across workspaces:

- `pnpm dev` - Start both frontend and backend development servers
- `pnpm dev:frontend` - Start frontend development server
- `pnpm dev:backend` - Start backend development server
- `pnpm build` - Build frontend
- `pnpm build:frontend` - Build frontend
- `pnpm build:backend` - Build backend
- `pnpm lint` - Lint frontend
- `pnpm lint:frontend` - Lint frontend
- `pnpm lint:backend` - Lint backend
- `pnpm preview` - Preview frontend build

## Individual Workspace Commands

You can also run commands directly in each workspace:

```bash
# Frontend
cd frontend
pnpm dev
pnpm build
pnpm lint

# Backend (when implemented)
cd backend
pnpm dev
pnpm build
pnpm lint
```

## Deployment

### Frontend

The frontend can be deployed using the build command and served as a static site.

### Backend

Backend deployment instructions will be added once the service is implemented.

## Contributing

1. Make changes in the appropriate workspace (`frontend/` or `backend/`)
2. Test your changes using the development commands
3. Ensure all linting passes
4. Commit and push your changes

## License

Private project - All rights reserved.
