"""Veo 2.0 Video Generation via Vertex AI with ADC authentication.

Called by the Express backend via child_process.
Saves the generated video to .sandbox/videos/<taskId>.mp4
Returns JSON with the result metadata.

Requires ADC (Application Default Credentials) to be configured:
  gcloud auth application-default login

Uses the GOOGLE_CLOUD_API_KEY env var OR project/location from env/args.
"""
import argparse
import json
import os
import sys
import time
import base64


def generate_video(prompt: str, output_path: str):
    """Generate a video using Veo 2.0 via Vertex AI with ADC auth."""
    from google import genai
    from google.genai import types

    client = genai.Client(
        vertexai=True,
        project="eburon-ai-beatrice",
        location="us-central1",
    )

    model_id = "veo-2.0-generate-001"

    source = types.GenerateVideosSource(prompt=prompt)

    config = types.GenerateVideosConfig(
        aspect_ratio="16:9",
        number_of_videos=1,
        duration_seconds=8,
        person_generation="allow_all",
        generate_audio=False,
        resolution="720p",
        enhance_prompt=True,
    )

    operation = client.models.generate_videos(
        model=model_id, source=source, config=config
    )

    # Wait for completion (up to 5 minutes, polling every 10 seconds)
    max_attempts = 30
    for attempt in range(max_attempts):
        time.sleep(10)
        operation = client.operations.get(operation)
        if operation.done:
            break

    if not operation.done:
        return {"error": "Video generation timed out after 5 minutes"}

    if not operation.result or not operation.result.generated_videos:
        return {
            "error": "No videos generated",
            "details": str(operation.result) if operation.result else "empty result",
        }

    videos = operation.result.generated_videos

    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    result_list = []
    for n, v in enumerate(videos):
        if v.video:
            this_path = output_path.replace(".mp4", f"_{n}.mp4") if n > 0 else output_path
            v.video.save(this_path)
            file_size = os.path.getsize(this_path)
            result_list.append({
                "ok": True,
                "filePath": this_path,
                "fileSize": file_size,
                "mimeType": "video/mp4",
                "durationSeconds": 8,
                "fileName": os.path.basename(this_path),
            })

    if not result_list:
        return {"error": "Generated videos had no data"}

    return result_list[0] if len(result_list) == 1 else {"videos": result_list}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate video with Veo 2.0")
    parser.add_argument("--prompt", type=str, required=True, help="Video description prompt")
    parser.add_argument("--output", type=str, default="", help="Output MP4 file path")
    parser.add_argument("--json", type=str, default="", help="JSON input with prompt, output")

    args = parser.parse_args()

    if args.json:
        data = json.loads(args.json)
        prompt = data.get("prompt", args.prompt)
        output = data.get("output", args.output)
    else:
        prompt = args.prompt
        output = args.output

    if not prompt:
        result = {"error": "No prompt provided"}
    elif not output:
        result = {"error": "No output path provided"}
    else:
        print(f"Starting Veo generation: {prompt[:80]}...", file=sys.stderr, flush=True)
        result = generate_video(prompt, output)

    print(json.dumps(result))
