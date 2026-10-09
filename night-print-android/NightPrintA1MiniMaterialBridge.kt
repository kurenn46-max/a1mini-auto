package com.u1.slicer

/** Resolved from the *same* profile values that are passed to native slicing.
 * A material label in a G-code footer is not enough: the native engine must receive it.
 */
internal object NightPrintA1MiniMaterialBridge {
    data class Material(val type: String, val nozzleC: Int)

    fun resolve(profileOverrides: Map<String, Any>): Material? {
        val rawType = (profileOverrides["filament_type"] as? List<*>)
            ?.firstOrNull()?.toString()?.trim()?.uppercase()
            ?: return null
        val rawTemp = (profileOverrides["nozzle_temperature"] as? List<*>)
            ?.firstOrNull()?.toString()?.trim()?.toDoubleOrNull()
            ?: return null
        if (!rawType.matches(Regex("[A-Z0-9_+.-]{2,24}"))) return null
        if (!rawTemp.isFinite() || rawTemp < 160 || rawTemp > 310) return null
        val temp = rawTemp.toInt()
        if (temp.toDouble() != rawTemp) return null
        return Material(rawType, temp)
    }
}
