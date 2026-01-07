#pragma once

namespace Mega1Link
{
    void begin();
    void update();

    // Sofortigen Status-Poll anstoßen (z.B. UI ↻ Prüfen)
    void requestPollNow();
}
