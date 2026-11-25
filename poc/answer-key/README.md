# 20 questions with a known answer: our tool and Codex

Run on 2026-11-25. The question, expected answer and citation were written from the documents before either system was asked, and each
quote was checked to be on the stated page or in the stated transcript. All 20 questions are answerable from the 50 COS512 files.

## Result

| | Our tool, 3 passages (current setting) | Our tool, 8 passages | Codex |
|---|---|---|---|
| Correct answers | 16 of 20, in both runs | 19 of 20 | 20 of 20 |
| Cites the expected file and page | 16 of 20 | 19 of 20 | 19 of 20 (Q6: right file, wrong time) |
| Time per question, min / median / max | 0.7 / 0.9 / 2.5 s (run 1), 0.4 / 0.6 / 1.8 s (run 2) | 1.0 / 1.5 / 2.2 s | 7.4 / 11.8 / 21.4 s |
| All 20 questions | 20.2 s, 12.9 s | 28.8 s | 249.9 s |
| Tokens | 19,358 in, 577 out (run 1) | not totalled | 962,308 in (587,136 of them cached), 7,950 out |
| Where it runs | Locally | Locally | OpenAI's servers |

- **Codex answered everything**, about 13 times slower at the median than our first run, with about 50 times the input tokens. It searches
  the files with `rg` and reads what it finds, one to four commands per question.
- **Our tool's four misses** are Q3, Q5, Q6 and Q11. In Q3 and Q11 the page with the answer was not among the 3 passages. In Q5 and Q6 the right
  transcript was, but not enough of it to answer from. Three were refusals; only Q11 gave a wrong answer (a different one each run).
- **Passages are the main limit here.** With 8 passages Q3, Q5 and Q11 became correct for about half a second more per question.

## Method

- **Tool:** `POST /v1/workspaces/cos512-ai/answers` on the local install, `qwen3.6-35b-a3b-splash`, reasoning none, nomic with prefixes,
  chunks 1200/200, top 3, minimum score 0.3. One unscored warm-up, then two runs; the 8-passage run sets `maxPassages`.
  Time is measured by the caller. Run 2 repeats the same prompts, so it is probably helped by caching.
- **Codex:** `codex exec` 0.153.4, `gpt-5.6-luna`, low reasoning effort, read-only sandbox, one new session per question, one run, on text
  extracts of the same 50 files with page markers. `gpt-6-luna`, listed as the affordable model, is refused for this account. Time is the whole
  command, including start-up. Codex returned answer, file, location and quote in a fixed JSON shape.
- **Grading:** by Claude, against the key. Citations: the tool is counted when a passage it cites is from the expected file and, for PDFs, page.

## Limits

- 20 questions, one Codex run. Claude wrote the questions and graded them; they are specific lookups, the easiest kind for text search.
- The tool's citation has a file and page for PDFs but no time for these transcripts (`startSeconds` is empty), so transcripts are checked by file only.
- Codex added facts that are not in the cited page: first names in Q9, and the XOR example in Q19.
- The tool and Codex read different extractions of the same PDFs (pypdf and pdftotext).

## Questions, expected answers and citations

| # | Question | Expected answer | Source | Quote |
|---|---|---|---|---|
| 1 | According to the Bellman-Ford slides, who originally proposed the algorithm, and in which year? | Alfonso Shimpel, in 1955. | COS512 W08 - OUC- Bellman Ford - Shortest Path Finding Algorithms.pdf, page 5 | originally proposed by Alfonso Shimpel (1955) |
| 2 | In which year did Robert Floyd receive the Turing Award? | 1978. | COS512 W09 - OUC- Floyd-Warshall - Shortest Path Finding Algorithms.pdf, page 3 | Turing award 1978 |
| 3 | By which other names is the Floyd-Warshall algorithm also known? | Roy-Warshall, Roy-Floyd, or WFI algorithm. | COS512 W09 - OUC- Floyd-Warshall - Shortest Path Finding Algorithms.pdf, page 4 | also known as Roy–Warshall or Roy–Floyd or WFI algorithm |
| 4 | In the Teachable Machine video, how many images are recorded for the banana class and how many for the cap class? | 94 banana images and 116 cap images. | COS512 W02 - TeachingMachineWithGoogle_3.transcript.md, 2:00 | 94 images, very good … 116 images |
| 5 | In the Teachable Machine video, what batch size does the example use? | 16 (16 images at a time). | COS512 W02 - TeachingMachineWithGoogle_3.transcript.md, 5:00 | In our case we have 16 images at a time |
| 6 | In the Langflow video with Gemini, which vector database replaces Astra DB, and why is it chosen? | ChromaDB, because it is local and free. | COS512 W07 - RAG-Langflow-Gemini.transcript.md, 3:22 | ChromaDB which is local and free |
| 7 | In the Langflow video with Gemini, what are the two opposing factions of the CMX game described in the loaded PDF? | Hackers and crackers. | COS512 W07 - RAG-Langflow-Gemini.transcript.md, 6:34 to 7:36 | two opposing factions, hackers and crackers |
| 8 | According to the GPT-1 slides, how many parameters does GPT-3 have, and how many is GPT-4 reported to have? | GPT-3 has 175 billion; GPT-4 is reported to have one trillion. | COS512 W04 - GPT-1.pdf, page 8 | with one trillion parameters |
| 9 | Who solved the disputed authorship of the Federalist papers in 1963, and with what kind of methods? | Mosteller and Wallace, with Bayesian methods. | COS512 W03 - Naive Bayes OUC.pdf, page 3 | solved by Mosteller and Wallace using Bayesian methods |
| 10 | Which five affective states are in the Scherer typology? | Emotion, mood, interpersonal stances, attitudes, personality traits. | COS512 W03 - Naive Bayes OUC.pdf, page 8 (also 9, 15) | Emotion … Mood … Interpersonal stances … Attitudes … Personality traits |
| 11 | What is the solution sequence for the sensorless vacuum world problem that starts in {1,2,3,4,5,6,7,8}? | [Right, Suck, Left, Suck]. | COS512 W06 - Solving problems by searching.pdf, page 9 | [Right,Suck,Left,Suck] |
| 12 | Which four items define a single-state search problem? | Initial state; actions or successor function; goal test; path cost. | COS512 W06 - Solving problems by searching.pdf, page 11 | A problem is defined by four items |
| 13 | In the neural networks slides, what does the output of a recurrent neural network depend on? | The present inputs and the previous step's neuron state. | COS512 W10 - Introduction_Neural_Networks.pdf, page 8 | also on the previous step’s neuron state |
| 14 | Under the closed world assumption, what can be minimized or eliminated if the world is controlled? | Sensing. | COS512 W12 - 2_AutomationAndAutonomy_ForLecture_OUC.pdf, page 12 | can minimize or eliminate sensing |
| 15 | What other names are given for motion planning in the robotics slides? | Path planning, the navigation problem, the piano mover's problem. | COS512 W11 - Robotics and Perception_OUC.pdf, page 12 | navigation problem or the piano mover's problem |
| 16 | How many IBM RS/6000 processors and how many custom VLSI chess processors did Deep Blue use? | 30 RS/6000 processors and 480 custom VLSI chess processors. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, page 204 | 480 custom VLSI chess processors |
| 17 | What is an admissible heuristic? | One that never overestimates the cost to reach the goal. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, page 113 | never overestimates the cost to reach the goal |
| 18 | Which three researchers did John McCarthy convince to help him organise the 1956 Dartmouth workshop? | Marvin Minsky, Claude Shannon and Nathaniel Rochester. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, page 36 | convinced Minsky, Claude Shannon, and Nathaniel Rochester |
| 19 | What limitation of single-layer perceptrons did Minsky and Papert's 1969 book Perceptrons point out? | They can represent only linearly separable concepts. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, page 780 | could represent only linearly separable concepts |
| 20 | In the video on installing Langflow and LM Studio, which Python version is installed and which option must be ticked first? | Python 3.10; tick "Add Python 3.10 to PATH". | COS512 W07 - Installing-Langflow-LM-Studio.transcript.md, 0:00 | add Python 3.10 to path |

## Verdicts and times

| # | Tool, 3 passages | Run 1 | Run 2 | Tool, 8 passages | Time | Codex | Time |
|---|---|---|---|---|---|---|---|
| 1 | Correct | 0.92 s | 0.43 s | Correct | 1.0 s | Correct | 16.2 s |
| 2 | Correct | 0.8 s | 0.4 s | Correct | 1.28 s | Correct | 8.0 s |
| 3 | Wrong (refused) | 0.8 s | 0.57 s | Correct | 1.12 s | Correct | 9.2 s |
| 4 | Correct | 0.89 s | 0.63 s | Correct | 1.52 s | Correct | 15.6 s |
| 5 | Wrong (refused) | 0.81 s | 0.5 s | Correct | 1.22 s | Correct | 7.4 s |
| 6 | Wrong (refused) | 0.83 s | 0.52 s | Wrong (refused) | 1.09 s | Correct, wrong time cited | 9.2 s |
| 7 | Correct | 0.88 s | 0.49 s | Correct | 1.51 s | Correct | 10.5 s |
| 8 | Correct | 0.99 s | 0.64 s | Correct | 1.44 s | Correct | 14.3 s |
| 9 | Correct | 0.91 s | 0.56 s | Correct | 1.46 s | Correct | 10.4 s |
| 10 | Correct | 0.88 s | 1.75 s | Correct | 1.67 s | Correct | 13.3 s |
| 11 | Wrong | 0.76 s | 0.5 s | Correct | 1.48 s | Correct | 8.2 s |
| 12 | Correct | 0.93 s | 0.73 s | Correct | 1.72 s | Correct | 11.0 s |
| 13 | Correct | 1.1 s | 0.55 s | Correct | 1.46 s | Correct | 11.8 s |
| 14 | Correct | 0.69 s | 1.19 s | Correct | 1.05 s | Correct | 16.7 s |
| 15 | Correct | 2.47 s | 0.47 s | Correct | 1.34 s | Correct | 11.7 s |
| 16 | Correct | 1.11 s | 0.6 s | Correct | 1.47 s | Correct | 16.4 s |
| 17 | Correct | 1.28 s | 0.75 s | Correct | 2.19 s | Correct | 12.7 s |
| 18 | Correct | 0.99 s | 0.46 s | Correct | 1.6 s | Correct | 11.5 s |
| 19 | Correct | 1.15 s | 0.6 s | Correct | 1.7 s | Correct | 14.4 s |
| 20 | Correct | 0.99 s | 0.58 s | Correct | 1.51 s | Correct | 21.4 s |

## Answers as given

Tool answers are run 1 at 3 passages. Numbers in brackets are its own passage numbers.

| # | Tool | Codex | Codex's citation |
|---|---|---|---|
| 1 | According to the slides, the algorithm was originally proposed by Alfonso Shimpel in 1955 [1]. | Alfonso Shimpel originally proposed it in 1955. | COS512 W08 - OUC- Bellman Ford - Shortest Path Finding Algorithms.pdf, Page 5 |
| 2 | Robert Floyd received the Turing Award in 1978 [1]. | Robert Floyd received the Turing Award in 1978. | COS512 W09 - OUC- Floyd-Warshall - Shortest Path Finding Algorithms.pdf, Page 3 |
| 3 | The material does not cover it. | It is also known as the Roy–Warshall, Roy–Floyd, or WFI algorithm. | COS512 W09 - OUC- Floyd-Warshall - Shortest Path Finding Algorithms.pdf, Page 4 |
| 4 | 94 images were recorded for the banana class and 116 images for the cap class [1]. | Banana: 94 images; cap: 116 images. | COS512 W02 - TeachingMachineWithGoogle_3.transcript.md, [2:00] |
| 5 | The material does not cover it. | The example uses a batch size of 16 images. | COS512 W02 - TeachingMachineWithGoogle_3.transcript.md, [5:00] |
| 6 | The material does not cover it. | ChromaDB replaces Astra DB because it is local and free. | COS512 W07 - RAG-Langflow-Gemini.transcript.md, [5:28] |
| 7 | The two opposing factions of the CMX game are hackers and crackers [3]. | The two factions are the hackers and the crackers. | COS512 W07 - RAG-Langflow-Gemini.transcript.md, [7:36] |
| 8 | GPT-3 has 175 billion parameters, and GPT-4 is reported to have one trillion parameters [1]. | GPT-3 has 175 billion parameters; GPT-4 is reported to have one trillion parameters. | COS512 W04 - GPT-1.pdf, Page 8 |
| 9 | Mosteller and Wallace solved the disputed authorship of 12 of the letters in 1963 using Bayesian methods [1]. | Frederick Mosteller and David Wallace solved it using Bayesian methods. | COS512 W03 - Naive Bayes OUC.pdf, Page 3 |
| 10 | The five affective states in the Scherer typology are Emotion, Mood, Interpersonal stances, Attitudes, and Personality traits [1][2][3]. | The five affective states are emotion, mood, interpersonal stances, attitudes, and personality traits. | COS512 W03 - Naive Bayes OUC.pdf, Page 8 |
| 11 | The solution sequence is [Right, Suck] [1]. | The solution sequence is [Right, Suck, Left, Suck]. | COS512 W06 - Solving problems by searching.pdf, Page 9 |
| 12 | A single-state problem is defined by four items: 1. initial state [1] 2. actions or successor function S(x) = set of action–state pairs [1] 3. goal test [1] 4. path cost (additive) [1] | The four items are: initial state; actions/successor function; goal test; and path cost. | COS512 W06 - Solving problems by searching.pdf, Page 11 |
| 13 | The output of a recurrent neural network depends not only on the present inputs but also on the previous step’s neuron state [1]. Additionally, the response of the network to a given input depends on its initial state, which may depend on previous inputs [2]. | The output depends on the present inputs and the previous step’s neuron state. | COS512 W10 - Introduction_Neural_Networks.pdf, Page 8 |
| 14 | If the world is controlled, sensing can be minimized or eliminated [1]. | Sensing can be minimized or eliminated if the world is controlled. | COS512 W12 - 2_AutomationAndAutonomy_ForLecture_OUC.pdf, Page 12 |
| 15 | Motion planning is also known as path planning, the navigation problem, or the piano mover's problem [1]. | The other names are path planning, the navigation problem, and the piano mover’s problem. | COS512 W11 - Robotics and Perception_OUC.pdf, Page 12 |
| 16 | Deep Blue used 30 IBM RS/6000 processors and 480 custom VLSI chess processors [1]. | Deep Blue used 30 IBM RS/6000 processors and 480 custom VLSI chess processors. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, Page 204 |
| 17 | An admissible heuristic is one that never overestimates the cost to reach the goal [2]. It is by nature optimistic because it assumes the cost of solving the problem is less than it actually is [1]. Specifically, an admissible heuristic never overestimates the true remaining cost [3]. | An admissible heuristic never overestimates the cost of reaching the goal. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, Page 113 |
| 18 | John McCarthy convinced Minsky, Claude Shannon, and Nathaniel Rochester to help him organize the 1956 Dartmouth workshop [1]. | Marvin Minsky, Claude Shannon, and Nathaniel Rochester. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, Page 36 |
| 19 | Minsky and Papert's 1969 book Perceptrons pointed out that single-layer perceptrons could represent only linearly separable concepts [1]. It also noted that a two-input perceptron could not be trained to recognize when its two inputs were different [2]. | Single-layer perceptrons could represent only linearly separable concepts, so they could not model functions like XOR. | COS512 - Artificial Intelligence_for_OUC s Platform Usage.pdf, Page 780 |
| 20 | Python 3.10 is installed, and the option "add Python 3.10 to path" must be ticked first [1]. | Python 3.10; tick “Add Python 3.10 to PATH” first. | COS512 W07 - Installing-Langflow-LM-Studio.transcript.md, [0:00] |
