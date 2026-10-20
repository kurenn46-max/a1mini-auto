package com.u1.slicer

/**
 * Single-spool A1 mini safety policy for user-confirmed, printer-reported
 * filament routes. Do not synthesize a virtual tray or guess filament type.
 *
 * This policy is intentionally separate from the MQTT project-file payload.
 */
internal object NightPrintExternalSpoolPolicy {
    fun singleLoadedExternalRoute(isA1Mini: Boolean, loadedRouteIds: List<Int>): Int? {
        if (!isA1Mini || loadedRouteIds.isEmpty()) return null
        // Any physically loaded AMS route or unresolved ID prevents auto-choice.
        if (loadedRouteIds.any { it < 254 }) return null
        return loadedRouteIds.distinct().singleOrNull()
    }

    fun mappingIssue(externalRoute: Int?, chosenRoutes: List<Int>): String? =
        if (externalRoute != null &&
            (chosenRoutes.isEmpty() || chosenRoutes.any { it != externalRoute })) {
            "NIGHT PRINT: 外付けスプールだけが認識されています。External spoolを選択してください。"
        } else null

    fun useAms(externalRoute: Int?): Boolean = externalRoute == null
}
