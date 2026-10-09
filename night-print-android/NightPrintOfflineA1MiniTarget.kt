package com.u1.slicer

import com.u1.slicer.data.Printer
import com.u1.slicer.data.PrinterKind
import com.u1.slicer.slice.SlicerTarget
import com.u1.slicer.slice.resolveDefaultSliceTarget

/**
 * This application is dedicated to the Bambu A1 mini.
 *
 * A missing network printer must NEVER silently choose the Snapmaker U1
 * engine (270 mm bed + wrong start G-code). Offline slicing is permitted.
 * A configured different printer remains visible and is blocked by the
 * explicit startSlicing guard rather than silently ignored.
 */
internal fun nightPrintOfflineA1MiniTarget(active: Printer?): SlicerTarget =
    when {
        active == null -> SlicerTarget.BambuA1Mini
        // Upstream migration creates an unpaired "Printer 1" MOONRAKER entry.
        // It is only a placeholder, not evidence of a configured U1.
        active.kind == PrinterKind.MOONRAKER && active.moonrakerUrl.isBlank() ->
            SlicerTarget.BambuA1Mini
        else -> resolveDefaultSliceTarget(active)
    }
