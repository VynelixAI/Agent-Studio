# Contributing to Agent Studio

Thank you for your interest in contributing to Agent Studio by VynelixAI.

Contributions, bug reports, feature requests, documentation improvements, and code improvements are welcome.

## Before You Start

Please:

1. Read the project README.
2. Check existing Issues and Pull Requests.
3. Avoid creating duplicate issues.
4. For security vulnerabilities, follow SECURITY.md instead of opening a public issue.

## Development Setup

### 1. Clone the Repository

Clone the repository and open the project directory:

git clone <repository-url>
cd VynelixAI_AgentStudio

### 2. Install Frontend Dependencies

From the project root, run:

npm install

### 3. Configure the Backend

Open the server directory:

cd server

Copy the example environment file.

For Linux or macOS:

cp .env.example .env

For Windows PowerShell:

Copy-Item .env.example .env

Install backend dependencies:

npm install

### 4. Start MongoDB

From the project root, start MongoDB:

npm run mongo:up

Alternatively:

docker compose up -d mongo

### 5. Start the Backend

Open a terminal in the server directory:

cd server
npm run dev

The API runs on:

http://localhost:8787

### 6. Start the Frontend

Open another terminal in the project root:

npm run dev

The Studio UI runs on:

http://localhost:1420

## Branching

Do not make changes directly on the main branch.

Create a feature branch for new features:

git checkout -b feature/your-feature-name

For bug fixes:

git checkout -b fix/your-fix-name

Use a clear branch name that describes the change.

## Making Changes

Before submitting a Pull Request:

- Keep changes focused.
- Follow the existing project structure.
- Follow the existing TypeScript and React patterns.
- Do not commit secrets or .env files.
- Update documentation when behavior changes.
- Add or update tests when appropriate.
- Keep unrelated changes out of the Pull Request.

## Testing

Before opening a Pull Request, run the relevant tests.

Run TypeScript validation:

npm run lint

Build the project:

npm run build

Run backend and stage tests:

npm run test:stage

Run domain tests:

npm run test:domains

## Commit Guidelines

Use clear and descriptive commit messages.

Examples:

feat: add MongoDB connector node

fix: resolve workflow validation issue

docs: update installation instructions

test: add workflow validation tests

refactor: simplify node registry

## Pull Requests

Push your feature branch:

git push origin feature/your-feature-name

Then open a Pull Request against the main branch.

A Pull Request should include:

- A clear title.
- A short description of the change.
- The reason for the change.
- Testing performed.
- Screenshots or recordings for relevant UI changes.
- Any known limitations or follow-up work.

## Pull Request Review

Maintainers may:

- Comment on the Pull Request.
- Request changes.
- Approve the Pull Request.
- Ask for additional tests or documentation.

Please address requested changes in your branch and push the updates.

The Pull Request will automatically update with your changes.

Changes should be merged only after the required review and checks have passed.

## Reporting Bugs

Before reporting a bug, check whether it has already been reported.

When opening a bug report, provide:

- What happened.
- What you expected to happen.
- Steps to reproduce.
- Environment details.
- Relevant logs or error messages.
- Screenshots when useful.

Do not include passwords, API keys, tokens, or other sensitive information.

## Feature Requests

Feature requests should explain:

- The problem being solved.
- The proposed solution.
- Why the feature would be useful.
- Any alternatives considered.

Large changes may require discussion before implementation.

## Documentation

Documentation improvements are welcome.

If a change affects:

- Installation
- Configuration
- API behavior
- Workflow YAML
- Desktop packaging
- Development commands

please update the relevant documentation.

## Security

Do not report security vulnerabilities through public GitHub Issues.

Please follow the instructions in:

SECURITY.md

## License

By contributing to this project, you agree that your contributions will be licensed under the Apache License 2.0.

See:

LICENSE

Thank you for contributing to Agent Studio.