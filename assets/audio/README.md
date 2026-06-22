# Audio assets

Drop two looping ambience files here to enable optional sound:

| File          | Plays when…                         | Suggested content                     |
| ------------- | ----------------------------------- | ------------------------------------- |
| `airport.mp3` | Before takeoff (gate → taxi)        | Quiet terminal / gate-area ambience   |
| `cabin.mp3`   | After takeoff (airborne → arrived)  | Cabin / engine hum / in-flight sound  |

The filenames/paths are configurable in [`../../config.js`](../../config.js) under `audio`.

The app works perfectly without these files — the audio toggle simply
reports `Audio: (no file)` and stays silent. Any loopable `.mp3`/`.ogg`
(a few minutes long) works well since playback loops automatically.

> Tip: free, license-friendly ambience can be found on sites like
> freesound.org or pixabay. Keep files reasonably small (< ~3 MB) so the
> static site stays snappy.
