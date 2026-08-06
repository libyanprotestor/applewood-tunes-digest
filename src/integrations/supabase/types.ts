export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      items: {
        Row: {
          artist_name: string | null
          created_at: string
          id: string
          isrc: string | null
          item_type: Database["public"]["Enums"]["item_type"]
          sublabel_id: string
          title: string
          upc: string | null
          updated_at: string
        }
        Insert: {
          artist_name?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          item_type?: Database["public"]["Enums"]["item_type"]
          sublabel_id: string
          title: string
          upc?: string | null
          updated_at?: string
        }
        Update: {
          artist_name?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          item_type?: Database["public"]["Enums"]["item_type"]
          sublabel_id?: string
          title?: string
          upc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          sublabel_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          sublabel_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          sublabel_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      report_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          region: string
          report_date: string
          retry_count: number
          revenue_usd: number
          rows_matched: number
          rows_parsed: number
          rows_unmatched: number
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          region: string
          report_date: string
          retry_count?: number
          revenue_usd?: number
          rows_matched?: number
          rows_parsed?: number
          rows_unmatched?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          region?: string
          report_date?: string
          retry_count?: number
          revenue_usd?: number
          rows_matched?: number
          rows_parsed?: number
          rows_unmatched?: number
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
        }
        Relationships: []
      }
      sales: {
        Row: {
          country_code: string | null
          created_at: string
          id: string
          item_id: string
          original_currency: string | null
          product_type_id: string | null
          region: string
          report_run_id: string | null
          revenue_usd: number
          sale_date: string
          sublabel_id: string
          units: number
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          id?: string
          item_id: string
          original_currency?: string | null
          product_type_id?: string | null
          region: string
          report_run_id?: string | null
          revenue_usd?: number
          sale_date: string
          sublabel_id: string
          units?: number
        }
        Update: {
          country_code?: string | null
          created_at?: string
          id?: string
          item_id?: string
          original_currency?: string | null
          product_type_id?: string | null
          region?: string
          report_run_id?: string | null
          revenue_usd?: number
          sale_date?: string
          sublabel_id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_sublabel_id_fkey"
            columns: ["sublabel_id"]
            isOneToOne: false
            referencedRelation: "sublabels"
            referencedColumns: ["id"]
          },
        ]
      }
      sublabels: {
        Row: {
          contact_email: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      unmatched_sales: {
        Row: {
          artist_name: string | null
          country_code: string | null
          created_at: string
          id: string
          isrc: string | null
          original_currency: string | null
          product_type_id: string | null
          region: string
          report_run_id: string | null
          resolved: boolean
          revenue_usd: number
          sale_date: string
          title: string | null
          units: number
          upc: string | null
        }
        Insert: {
          artist_name?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          original_currency?: string | null
          product_type_id?: string | null
          region: string
          report_run_id?: string | null
          resolved?: boolean
          revenue_usd?: number
          sale_date: string
          title?: string | null
          units?: number
          upc?: string | null
        }
        Update: {
          artist_name?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          isrc?: string | null
          original_currency?: string | null
          product_type_id?: string | null
          region?: string
          report_run_id?: string | null
          resolved?: boolean
          revenue_usd?: number
          sale_date?: string
          title?: string | null
          units?: number
          upc?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_sales_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_sublabel_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      sales_summary: {
        Args: {
          _bucket: string
          _from: string
          _sublabel?: string
          _to: string
        }
        Returns: {
          bucket: string
          revenue_usd: number
          units: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "sublabel"
      item_type: "ringtone" | "single" | "album" | "other"
      run_status: "pending" | "success" | "not_ready" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sublabel"],
      item_type: ["ringtone", "single", "album", "other"],
      run_status: ["pending", "success", "not_ready", "failed"],
    },
  },
} as const
