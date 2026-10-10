package com.u1.slicer

import java.io.File
import java.io.RandomAccessFile

/**
 * Read-only information about the actual sliced G-code.
 *
 * The saved base SliceConfig can differ from an imported 3MF's process
 * (e.g. 15% instead of PETG ring's 20%). The G-code footer is authoritative
 * for displayed process values. This reader never edits G-code and must
 * never substitute for the existing print safety gates.
 */
internal object NightPrintV341GcodeMetadata {
    internal data class Result(
        val printedLayers: Int?,
        val layerHeight: Float?,
        val infillDensity: Float?,
        val filamentType: String?,
        val nozzleTemp: Int?,
        val supportEnabled: Boolean?,
    )
    private const val MAX_TAIL_BYTES = 300_000

    fun read(path: String): Result? = runCatching {
        val file = File(path)
        if (!file.isFile || file.length() <= 0L) return null
        val footer = RandomAccessFile(file, "r").use { f ->
            val n = minOf(f.length(), MAX_TAIL_BYTES.toLong()).toInt()
            f.seek(f.length() - n)
            ByteArray(n).also { f.readFully(it) }.toString(Charsets.UTF_8)
        }
        val fields = mutableMapOf<String, String>()
        // Footer keys are supplied as ; key = value. Preserve only known ones:
        // machine_start_gcode/machine_end_gcode can have arbitrarily long bodies.
        for (line in footer.lineSequence()) {
            if (!line.startsWith("; ")) continue
            val at = line.indexOf(" = ")
            if (at <= 2) continue
            val key = line.substring(2, at)
            if (key in setOf("layer_height", "sparse_infill_density",
                    "filament_type", "nozzle_temperature", "enable_support")) {
                fields[key] = line.substring(at + 3).trim()
            }
        }
        val density = fields["sparse_infill_density"]?.removeSuffix("%")
            ?.toFloatOrNull()?.let { it / 100f }?.takeIf { it in 0f..1f }
        val layer = fields["layer_height"]?.toFloatOrNull()
            ?.takeIf { it in 0.05f..0.4f }
        // Only identify one physical material; multi-extruder CSV fields
        // must not be mislabeled as a single material.
        val material = fields["filament_type"]
            ?.trim()?.takeIf { it.matches(Regex("[A-Za-z][A-Za-z0-9_+ -]{1,31}")) }
        val temp = fields["nozzle_temperature"]?.toIntOrNull()
            ?.takeIf { it in 100..320 }
        val support = when (fields["enable_support"]?.lowercase()) {
            "1", "true" -> true
            "0", "false" -> false
            else -> null
        }

        // Count real Orca layer change markers. Ignore Z-hop and end parking.
        // Missing markers => unknown, not a fabricated 0-layer result.
        var count = 0
        file.forEachLine { line ->
            if (line.trim() == ";LAYER_CHANGE") count++
        }
        Result(count.takeIf { it > 0 }, layer, density, material, temp, support)
    }.getOrNull()
}
