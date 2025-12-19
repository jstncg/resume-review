# Ashby like Resume Reviewer

## Take-home assignment

Should build application that meets the requirement in this file: [`Andres_-_Take_home_assignment.pdf`](./Andres_-_Take_home_assignment.pdf)

## Tech-Stacks

    - Next.js : Main Framework
    - Chokidar : Monitoring the directory
    - PDF-PARSE : Reading the PDF context
    - OpenAI : LLM integration
    - TailwindCSS : Implementing the stylesheet

## Workflow

    - When the PDF is being added to the directory
    - The record (name, "pending") is added to the manifest.csv
    - The PDF would be enqueued to the analysis pipeline and the record in csv is updated to (name, "in_progress")
    - When the analysis is finished, the record is being updated to (name, "bad_fit") or (name, "good_fit")
    - Once the user submits the review on the "good_fit" items, the record is updated to (name, "user_reviewed")

    The changes on status in csv is reflected to the frontend using SSE(Server-Side-Event).

## Improvements

    - Introduce PostgreSQL as Database
        Create db_resume, db_status, db_review, db_log
    - Introduce Prisma for ORM
    - Integrate services for messaging queues and configure re-trying logic

    - Implement ShadCN based Stylesheet on the frontend
    - When user clicks the items, they should be able to see the history of status changes.

## How to run the app

    - Create .env (.env.local) with the below fields
        OPENAI_API_KEY= // OpenAI key
        ANALYSIS_CONDITION= // Default Resume Analysis condition
        OPENAI_MODEL= // GPT model for resume analysis
        ANALYSIS_MAX_CONCURRENCY= // Maximum count that can be processed at once
    - Without Docker
        - Install necessary packages
            npm install
        - Run the app
            npm run dev

    - With Docker
        docker compose up --build
