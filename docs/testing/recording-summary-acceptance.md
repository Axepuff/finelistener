# Recording summary acceptance

Tested on Windows x64 with an NVIDIA GeForce GTX 1070. All conversations used for these checks were synthetic.

## What to verify

1. Open a completed transcript in a fresh profile and choose **Summary**. It should offer **Download model** and show the 2.50 GB transfer size.
2. Start the download. After integrity verification, **Generate summary** should become available. Reopen the session before selecting it and confirm there is still no generated text.
3. Generate the two formats. In the saved transcript, joining the reviewed paragraphs with a blank line must reproduce **Detailed notes** exactly. **Brief overview** should give a shorter account of the main topics.
4. Quit and reopen the packaged app offline. Read both formats again with the weights absent. In a profile with the weights installed, generate a summary for a different session offline.
5. For a partial result, interrupt generation after the detailed paragraphs have been saved. Reopen the session and choose **Generate brief summary**. The detailed text should survive the interruption and retry.

## Model and runtime

The Windows GPU package uses llama.cpp b12503 with Vulkan and Qwen3-4B-Instruct-2507 Q4_K_M. The packaged app downloaded 2,497,281,120 bytes from the pinned source, verified the checksum and waited for an explicit generation request. The inference window was 6,144 tokens. The chunker targeted about 1,900 transcript tokens and used the model tokenizer to check each prompt and response budget.

The Windows CPU and Apple Silicon builds stage separate native runtimes. Real inference in this review ran on the Windows GPU. If the native runtime cannot be found, the interface reports “The local summary service is unavailable.”

## Quality checks

Check the generated texts against the transcript as well as against each other. In the short Russian fixture, twelve was an early estimate, nine applications were accepted, Irina agreed to send the minutes on Friday, and a Monday meeting remained a suggestion. The source did not establish who would attend.

The revised brief kept the count, Friday deadline and proposed status in 10 words. Its phrasing was terse. The 33-word detailed paragraph added that the meeting had no participants. Reviewing the draft against the source did not remove that unsupported claim. On the short English shipment fixture the model kept the estimated and final quantities, the deadline and the status of the second shipment in a 16-word brief.

The longer Russian fixture contains 35 timed turns by two speakers discussing a trial shipment. The final quantity is nine boxes, Friday is the deadline for sending a written report, and a second shipment was only discussed. The speakers agree to put the nearest gate and client in the working list. The separate warehouse log is for recording actual arrival time. [Read the synthetic transcript](recording-summary-warehouse-ru.txt).

The packaged Windows app processed the 755-word fixture offline in 73 seconds. It produced two reviewed paragraphs (73 words total) and a 32-word brief. Before the length check, the brief was 63 words. Counts use word-like segments. After separate restarts, both formats matched the saved texts with the original profile and with a model-free profile.

Both outputs kept the final quantity, deadline and status of the second shipment. The detailed output confused the working list and warehouse log. The brief added an unsupported assertion that the document would be sent early. These runs establish behavior on these fixtures only.

**Brief overview**

Анна подтвердила поставку девяти коробок — три пустых исключены. Отчёт отправят покупателю в пятницу. Вторая партия не запланирована. Документ отправляется до срока. Указаны адрес склада, состояние коробок — при отсутствии замечаний достаточно подтвердить получение.

**Detailed notes**

Согласовано: в журнале указывать ближние ворота и клиента, оставить подписанную копию накладной у дежурного, снять фото с площадки, отправить отдельный файл с описанием поставки, указать адрес склада и требование о состоянии коробок — при отсутствии замечаний достаточно подтвердить получение.

Анна подтвердила, что в пробную поставку идут девять коробок — три пустых образца исключены, и отчёт отправят покупателю в пятницу. Вторая партия не запланирована, договорённостей об отгрузке нет. Срок относится к отправке документа, не к совещанию.
