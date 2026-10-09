package com.u1.slicer

import org.json.JSONObject
import java.io.File
import java.util.zip.ZipFile

/**
 * Read exactly one single-filament PETG profile from an imported 3MF.
 * The geometry is validated separately by ThreeMfParser and the native engine.
 * Never mutate the source file or executable G-code.
 */
internal object NightPrintImported3mfProfile {
    data class Material(val filamentType: String, val nozzleC: Int, val bedC: Int)
    private const val MAX_CONFIG_BYTES = 64L * 1024L

    fun read(file: File?): Material? {
        if (file == null || !file.isFile ||
            !file.extension.equals("3mf", ignoreCase = true) ||
            file.length() > 120L * 1024L * 1024L
        ) return null

        return runCatching {
            ZipFile(file).use { zip ->
                val entry = zip.getEntry("Metadata/project_settings.config")
                    ?: return@use null
                if (entry.size !in 1L..MAX_CONFIG_BYTES) return@use null
                val data = zip.getInputStream(entry).use { it.readBytes() }
                if (data.size > MAX_CONFIG_BYTES) return@use null
                val json = JSONObject(String(data, Charsets.UTF_8))
                fun oneString(name: String): String? {
                    val array = json.optJSONArray(name) ?: return null
                    if (array.length() != 1) return null
                    return array.optString(0).takeIf { it.isNotBlank() }
                }
                val mat = oneString("filament_type") ?: return@use null
                if (!mat.equals("PETG", ignoreCase = true)) return@use null
                val nozzle = oneString("nozzle_temperature")?.toIntOrNull()
                    ?: return@use null
                val initialNozzle = oneString("nozzle_temperature_initial_layer")?.toIntOrNull()
                    ?: return@use null
                if (nozzle != initialNozzle || nozzle !in 170..300) return@use null
                val bed = (oneString("textured_plate_temp") ?: oneString("hot_plate_temp"))
                    ?.toIntOrNull() ?: return@use null
                if (bed !in 0..80) return@use null
                Material("PETG", nozzle, bed)
            }
        }.getOrNull()
    }
}
